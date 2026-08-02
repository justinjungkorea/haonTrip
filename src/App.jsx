import React, { useMemo, useState, useEffect, useRef } from "react";
import { useSwipeable } from "react-swipeable";
import { FaPlaneDeparture } from "react-icons/fa";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

/** ===== Time / TZ helpers ===== */
const TZ_MAP = {
  KST: "Asia/Seoul",
  PST: "America/Los_Angeles",
  EST: "America/New_York",
  CST: "America/Chicago",
  MST: "America/Denver",
  HST: "Pacific/Honolulu"
};

const toMinutes = (hm) => {
  let [h, m] = hm.split(":").map(Number);
  if (h === 23 && m === 59) {
    h = 24;
    m = 0;
  }
  return h * 60 + m;
};

const formatDate = (dateStr) => {
  const dt = dayjs(dateStr);
  const yoil = ["일", "월", "화", "수", "목", "금", "토"][dt.day()];
  return `${dt.month() + 1}월 ${dt.date()}일 (${yoil})`;
};

const HOUR_HEIGHT = 80;
const PX_PER_MIN = HOUR_HEIGHT / 60;

function addEventToBuckets(ev, displayTimezone, map) {
  const tzIana = TZ_MAP[displayTimezone] || "UTC";
  
  const start = dayjs(ev.startUtc).tz(tzIana);
  const end = dayjs(ev.endUtc).tz(tzIana);
  
  let curDay = start.startOf('day');
  const lastDay = end.startOf('day');
  
  while (curDay.isBefore(lastDay) || curDay.isSame(lastDay)) {
    const dateStr = curDay.format("YYYY-MM-DD");
    let startHM, endHM;
    
    if (curDay.isSame(start.startOf('day')) && curDay.isSame(lastDay)) {
      startHM = start.format("HH:mm");
      endHM = end.format("HH:mm");
    } else if (curDay.isSame(start.startOf('day'))) {
      startHM = start.format("HH:mm");
      endHM = "23:59";
    } else if (curDay.isSame(lastDay)) {
      startHM = "00:00";
      endHM = end.format("HH:mm");
    } else {
      startHM = "00:00";
      endHM = "23:59";
    }
    
    if (startHM !== endHM) {
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr).push({
        title: ev.title,
        start: startHM,
        end: endHM,
        note: ev.note,
      });
    }
    
    curDay = curDay.add(1, 'day');
  }
}

function normalizeTime(t) {
  if (!t) return "00:00";
  const [h, m] = t.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

async function fetchItinerary() {
  const res = await fetch(import.meta.env.VITE_SHEET_URL);
  const text = await res.text();
  const rows = text.trim().split("\n");
  
  const header = rows[0].split(",").map((h) => h.trim().replace(/^\uFEFF/, ""));
  
  // 정규식을 사용해 숨겨진 따옴표나 특수문자를 제거하고 순수 알파벳만 추출
  const rawTz = header[7] || "PST";
  const sheetDefaultTz = rawTz.replace(/[^a-zA-Z]/g, "").toUpperCase();

  const data = rows.slice(1).map((line) => {
    const cols = line.split(",").map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] || ""));

    const sDate = obj["시작일"];
    const sTime = normalizeTime(obj["시작시간"]);
    const eDate = obj["종료일"];
    const eTime = normalizeTime(obj["종료시간"]);
    const tz = obj["타임존"] || "KST";

    const iana = TZ_MAP[tz] || "UTC";
    const startUtc = dayjs.tz(`${sDate} ${sTime}`, iana).valueOf();
    const endUtc = dayjs.tz(`${eDate} ${eTime}`, iana).valueOf();

    return {
      title: obj["제목"],
      startUtc,
      endUtc,
      originalTz: tz,
      note: obj["노트"],
    };
  });

  return { data, sheetDefaultTz };
}

async function fetchHotels() {
  const res = await fetch(import.meta.env.VITE_HOTEL_URL);
  const text = await res.text();
  const rows = text.trim().split("\n");
  const header = rows[0].split(",").map((h) => h.trim().replace(/^\uFEFF/, ""));

  return rows.slice(1).map((line) => {
    const cols = line.split(",").map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] || ""));
    return {
      date: obj["Date"],
      name: obj["Hotel"],
    };
  });
}

function shallowEqualArray(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (JSON.stringify(arr1[i]) !== JSON.stringify(arr2[i])) return false;
  }
  return true;
}

const getNowInTimezone = (timezone) => {
  const iana = TZ_MAP[timezone] || "UTC";
  const now = dayjs().tz(iana);

  return {
    full: now.toDate(),
    dateStr: now.format("YYYY-MM-DD"),
    hm: now.format("HH:mm"),
  };
};

export default function App() {
  const [defaultTz, setDefaultTz] = useState("PST");
  const [timezone, setTimezone] = useState("PST");
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNote, setSelectedNote] = useState(null);

  const [nowInTZ, setNowInTZ] = useState(() => getNowInTimezone(timezone));
  const [snapToToday, setSnapToToday] = useState(true);

  useEffect(() => {
    let timer;
    let isInitialLoad = true;

    const loadData = async () => {
      try {
        const [itineraryRes, newHotels] = await Promise.all([fetchItinerary(), fetchHotels()]);
        const { data: newEvents, sheetDefaultTz } = itineraryRes;

        // 상태 업데이트 분리: 데이터 로드 시 defaultTz를 독립적으로 갱신
        setDefaultTz(sheetDefaultTz);
        if (isInitialLoad) {
          setTimezone(sheetDefaultTz);
          isInitialLoad = false;
        }

        setEvents((prev) => (shallowEqualArray(prev, newEvents) ? prev : newEvents));
        setHotels((prev) => (shallowEqualArray(prev, newHotels) ? prev : newHotels));
        setLoading(false);
      } catch (err) {
        console.error("데이터 로드 실패:", err);
      }
    };
    loadData();
    timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setNowInTZ(getNowInTimezone(timezone));
    const t = setInterval(() => setNowInTZ(getNowInTimezone(timezone)), 30000);
    return () => clearInterval(t);
  }, [timezone]);

  const buckets = useMemo(() => {
    const map = new Map();
    for (const ev of events) addEventToBuckets(ev, timezone, map);
    for (const [k, arr] of map) {
      arr.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    }
    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }, [events, timezone]);

  const dates = [...buckets.keys()];
  const totalPages = Math.max(1, dates.length - 1);

  const [daysPerPage, setDaysPerPage] = useState(2);
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 600) setDaysPerPage(3);
      else if (window.innerWidth <= 900) setDaysPerPage(5);
      else setDaysPerPage(7);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!snapToToday) return;
    const todayIdx = dates.indexOf(nowInTZ.dateStr);
    if (todayIdx === -1) return;

    const maxLeft = Math.max(0, dates.length - daysPerPage);
    const clamped = Math.max(0, Math.min(todayIdx, maxLeft));
    setPage(clamped);
  }, [snapToToday, dates, daysPerPage, nowInTZ.dateStr]);

  const curPage = Math.min(page, totalPages - 1);
  const days = dates.slice(curPage, curPage + daysPerPage);

  const [dayStartHour, dayEndHour] = useMemo(() => {
    let min = 24 * 60;
    let max = 0;
    for (const d of days) {
      const arr = buckets.get(d) || [];
      for (const ev of arr) {
        const s = toMinutes(ev.start);
        const e = toMinutes(ev.end);
        min = Math.min(min, s);
        max = Math.max(max, e);
      }
    }
    if (min === 24 * 60) min = 8 * 60;
    if (max === 0) max = 20 * 60;
    return [Math.floor(min / 60), Math.ceil(max / 60)];
  }, [buckets, days]);

  const hours = useMemo(() => {
    const arr = [];
    for (let h = dayStartHour; h <= dayEndHour; h++) arr.push(h);
    return arr;
  }, [dayStartHour, dayEndHour]);

  const swipe = useSwipeable({
    onSwipedLeft: () => {
      setPage((p) => Math.min(p + 1, totalPages - 1));
      setSnapToToday(false);
    },
    onSwipedRight: () => {
      setPage((p) => Math.max(p - 1, 0));
      setSnapToToday(false);
    },
    trackMouse: true,
  });

  const colors = ["bg-blue-200", "bg-green-200", "bg-yellow-200", "bg-purple-200", "bg-pink-200"];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-400 border-t-transparent"></div>
      </div>
    );
  }

  const nowDateStr = nowInTZ.dateStr;
  const nowHM = nowInTZ.hm;
  const nowMin = toMinutes(nowHM);
  const canDrawNowLine = days.includes(nowDateStr) && nowMin >= dayStartHour * 60 && nowMin <= dayEndHour * 60;
  const nowTop = (nowMin - dayStartHour * 60) * PX_PER_MIN;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-50 to-white" {...swipe}>
      <header className="flex justify-between items-center p-4 bg-white shadow-md">
        <div className="flex items-center space-x-2 font-bold text-lg text-gray-700">
          <FaPlaneDeparture className="text-blue-500" />
          <span>여행 일정</span>
        </div>
        {defaultTz !== "KST" && (
          <button
            className="px-4 py-1 rounded-full bg-blue-500 text-white text-sm shadow hover:bg-blue-600 transition"
            onClick={() => {
              setTimezone((t) => (t === "KST" ? defaultTz : "KST"));
              setSnapToToday(true);
            }}
          >
            {timezone === "KST" ? "현지시간" : "한국시간"}
          </button>
        )}
      </header>

      <div className="flex border-b border-gray-200 bg-white shadow-sm">
        <div className="w-12" />
        {days.map((d) => (
          <div key={d} className="flex-1 text-center py-2">
            <div className="font-semibold">{formatDate(d)}</div>
            {hotels
              .filter((h) => h.date === d)
              .map((hotel, idx) => (
                <div
                  key={idx}
                  className="mt-1 mx-auto max-w-[90%] bg-yellow-100 border border-yellow-300 rounded-lg px-2 py-1 text-[10px] text-gray-700 shadow-sm"
                >
                  🏨 {hotel.name}
                </div>
              ))}
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-y-auto">
        <div className="w-12 border-r border-gray-200 bg-gray-50 sticky left-0 z-10">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_HEIGHT }}>
              <span className="absolute top-1 right-1 text-[10px] text-gray-400">{h}:00</span>
            </div>
          ))}
        </div>

        <div
          className="grid flex-1 gap-2 px-3 relative"
          style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
        >
          {days.map((date) => {
            const events = buckets.get(date) || [];
            const isTodayColumn = canDrawNowLine && date === nowDateStr;

            return (
              <div
                key={date}
                className="relative border-l border-gray-100"
                style={{
                  display: "grid",
                  gridTemplateRows: `repeat(${(dayEndHour - dayStartHour) * 60}, ${PX_PER_MIN}px)`,
                }}
              >
                {isTodayColumn && (
                  <div className="absolute left-0 right-0" style={{ top: nowTop, zIndex: 20 }}>
                    <div className="h-0.5 bg-red-500 w-full" />
                  </div>
                )}

                {events.map((ev, idx) => {
                  const sMin = toMinutes(ev.start) - dayStartHour * 60;
                  const eMin = toMinutes(ev.end) - dayStartHour * 60;
                  if (eMin <= sMin) return null;
                  const color = colors[idx % colors.length];
                  return (
                    <div
                      key={idx}
                      onClick={() => ev.note && setSelectedNote(ev.note)}
                      className={`rounded-xl border border-gray-300 shadow-md p-2 text-[11px] transition transform hover:scale-105 hover:shadow-lg ${color}`}
                      style={{ gridRow: `${sMin + 1} / ${eMin + 1}` }}
                    >
                      <div className="text-[9px] font-bold text-gray-700 break-words">
                        {ev.start} ~ {ev.end}
                      </div>
                      <div className="text-[12px] font-semibold text-gray-900 mt-1 break-words flex gap-1">
                        {ev.title}
                        {ev.note && <span role="img" aria-label="note" className="text-xs">📝</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {selectedNote && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50"
          onClick={() => setSelectedNote(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-md w-[90%] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-2">노트</h2>
            <div className="text-gray-700 whitespace-pre-wrap max-h-[300px] overflow-y-auto pr-2">
              {selectedNote}
            </div>
            <button
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
              onClick={() => setSelectedNote(null)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
