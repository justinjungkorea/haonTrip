import React, { useMemo, useState, useEffect } from "react";
import { useSwipeable } from "react-swipeable";
import { FaPlaneDeparture } from "react-icons/fa";

/** ===== Time / TZ helpers ===== */
const tzOffsets = { KST: 0, PST: -17 };

const toMinutes = (hm) => {
  let [h, m] = hm.split(":").map(Number);
  if (h === 23 && m === 59) {
    h = 24;
    m = 0;
  }
  return h * 60 + m;
};

const parseDateTime = (dateStr, hm) => {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date(`${dateStr}T${hm}:00`);
  d.setHours(h, m, 0, 0);
  return d;
};

const convertDateTime = (dateStr, hm, fromTZ, toTZ) => {
  const d = parseDateTime(dateStr, hm);
  d.setHours(d.getHours() + (tzOffsets[toTZ] - tzOffsets[fromTZ]));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${HH}:${MM}`, full: d };
};

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  const yoil = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${yoil})`;
};

/** ===== Layout config ===== */
const HOUR_HEIGHT = 80;
const PX_PER_MIN = HOUR_HEIGHT / 60;

/** 이벤트 분리 */
function addEventToBuckets(ev, timezone, map) {
  const getDateString = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const s = convertDateTime(ev.startDate, ev.startTime, ev.tz, timezone);
  const e = convertDateTime(ev.endDate, ev.endTime, ev.tz, timezone);

  let cur = new Date(s.full);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(e.full);
  last.setHours(0, 0, 0, 0);

  while (cur.getTime() <= last.getTime()) {
    const curDate = getDateString(cur);
    let startHM, endHM;

    if (curDate === s.date && curDate === e.date) {
      startHM = s.time;
      endHM = e.time;
    } else if (curDate === s.date) {
      startHM = s.time;
      endHM = "23:59";
    } else if (curDate === e.date) {
      startHM = "00:00";
      endHM = e.time;
    } else {
      cur.setDate(cur.getDate() + 1);
      continue;
    }

    if (!map.has(curDate)) map.set(curDate, []);
    map.get(curDate).push({ title: ev.title, start: startHM, end: endHM });

    cur.setDate(cur.getDate() + 1);
  }
}

/** ===== 데이터 fetch ===== */
function normalizeTime(t) {
  if (!t) return "00:00";
  const [h, m] = t.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

async function fetchItinerary() {
  const res = await fetch(import.meta.env.VITE_SHEET_URL);
  const text = await res.text();
  const rows = text.trim().split("\n");
  const header = rows[0].split(",").map((h) => h.trim());

  return rows.slice(1).map((line) => {
    const cols = line.split(",").map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] || ""));
    return {
      startDate: obj["시작일"],
      startTime: normalizeTime(obj["시작시간"]),
      endDate: obj["종료일"],
      endTime: normalizeTime(obj["종료시간"]),
      title: obj["제목"],
      tz: obj["타임존"],
    };
  });
}

async function fetchHotels() {
  const res = await fetch(import.meta.env.VITE_HOTEL_URL);
  const text = await res.text();
  const rows = text.trim().split("\n");
  const header = rows[0].split(",").map((h) => h.trim());

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

/** 간단 비교 함수 */
function shallowEqualArray(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (JSON.stringify(arr1[i]) !== JSON.stringify(arr2[i])) return false;
  }
  return true;
}

export default function App() {
  const [timezone, setTimezone] = useState("PST");
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);

  /** 구글 시트 fetch */
  useEffect(() => {
    let timer;
    const loadData = async () => {
      try {
        const [newEvents, newHotels] = await Promise.all([fetchItinerary(), fetchHotels()]);

        setEvents((prev) => (shallowEqualArray(prev, newEvents) ? prev : newEvents));
        setHotels((prev) => (shallowEqualArray(prev, newHotels) ? prev : newHotels));

        setLoading(false);
      } catch (err) {
        console.error("데이터 로드 실패:", err);
      }
    };

    loadData();
    timer = setInterval(loadData, 30000); // 30초마다 새로고침 (변화 있을 때만 업데이트)

    return () => clearInterval(timer);
  }, []);

  // 버킷 생성
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
  const curPage = Math.min(page, totalPages - 1);

  // 화면 너비에 따라 표시할 일수 계산
  const [daysPerPage, setDaysPerPage] = useState(2);
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 600) setDaysPerPage(3);
      else if (window.innerWidth <= 900) setDaysPerPage(4);
      else setDaysPerPage(5);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const days = dates.slice(curPage, curPage + daysPerPage);

  // 시간 범위 자동 계산
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
    onSwipedLeft: () => setPage((p) => Math.min(p + 1, totalPages - 1)),
    onSwipedRight: () => setPage((p) => Math.max(p - 1, 0)),
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

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-50 to-white" {...swipe}>
      {/* 상단 헤더 */}
      <header className="flex justify-between items-center p-4 bg-white shadow-md">
        <div className="flex items-center space-x-2 font-bold text-lg text-gray-700">
          <FaPlaneDeparture className="text-blue-500" />
          <span>여행 일정</span>
        </div>
        <button
          className="px-4 py-1 rounded-full bg-blue-500 text-white text-sm shadow hover:bg-blue-600 transition"
          onClick={() => setTimezone((t) => (t === "KST" ? "PST" : "KST"))}
        >
          {timezone === "KST" ? "현지시간" : "한국시간"}
        </button>
      </header>

      {/* 날짜 헤더 + 호텔 */}
      <div className="flex border-b border-gray-200 bg-white shadow-sm">
        <div className="w-12" /> {/* 시간축 너비 */}
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

      {/* 본문 */}
      <div className="flex flex-1 overflow-y-auto">
        {/* 시간축 */}
        <div className="w-12 border-r border-gray-200 bg-gray-50 sticky left-0 z-10">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_HEIGHT }}>
              <span className="absolute top-1 right-1 text-xs text-gray-400">{h}:00</span>
            </div>
          ))}
        </div>

        {/* 일정 칼럼 */}
        <div
          className="grid flex-1 gap-2 px-3 relative"
          style={{ gridTemplateColumns: `repeat(${daysPerPage}, 1fr)` }}
        >
          {days.map((date) => {
            const events = buckets.get(date) || [];
            return (
              <div
                key={date}
                className="relative border-l border-gray-100"
                style={{
                  display: "grid",
                  gridTemplateRows: `repeat(${(dayEndHour - dayStartHour) * 60}, ${PX_PER_MIN}px)`,
                }}
              >
                {events.map((ev, idx) => {
                  const sMin = toMinutes(ev.start) - dayStartHour * 60;
                  const eMin = toMinutes(ev.end) - dayStartHour * 60;
                  if (eMin <= sMin) return null;
                  const color = colors[idx % colors.length];
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border border-gray-300 shadow-md p-2 transition transform hover:scale-105 hover:shadow-lg ${color}`}
                      style={{
                        gridRow: `${sMin + 1} / ${eMin + 1}`,
                        justifySelf: "stretch",
                      }}
                    >
                      <div className="text-[10px] font-bold text-gray-700 break-words">
                        {ev.start} ~ {ev.end}
                      </div>
                      <div className="text-[12px] font-semibold text-gray-900 mt-1 break-words">
                        {ev.title}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
