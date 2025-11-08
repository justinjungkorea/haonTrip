import React, { useMemo, useState, useEffect, useRef } from "react";
import { useSwipeable } from "react-swipeable";
import { FaPlaneDeparture } from "react-icons/fa";

/** ===== Time / TZ helpers ===== */
const tzOffsets = { KST: 0, PST: -17 }; // KST 기준 상대 오프셋

const toMinutes = (hm) => {
  let [h, m] = hm.split(":").map(Number);
  if (h === 23 && m === 59) {
    h = 24;
    m = 0;
  }
  return h * 60 + m;
};

/** UTC 기준으로 Date 생성 */
const parseDateTimeUTC = (dateStr, hm) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [H, M] = hm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, H, M, 0, 0));
};

/** UTC에서만 가감 + UTC로 문자열 생성 */
const convertDateTime = (dateStr, hm, fromTZ, toTZ) => {
  const d = parseDateTimeUTC(dateStr, hm);
  d.setUTCHours(d.getUTCHours() + (tzOffsets[toTZ] - tzOffsets[fromTZ]));

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");

  return { date: `${yyyy}-${mm}-${dd}`, time: `${HH}:${MM}`, full: d };
};

/** 날짜 포맷(UTC) */
const formatDate = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0));
  const yoil = ["일", "월", "화", "수", "목", "금", "토"][dt.getUTCDay()];
  return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${yoil})`;
};

/** ===== Layout config ===== */
const HOUR_HEIGHT = 80;
const PX_PER_MIN = HOUR_HEIGHT / 60;

/** 이벤트를 날짜별로 분배 (UTC만 사용) */
function addEventToBuckets(ev, timezone, map) {
  const getDateStringUTC = (d) => {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const s = convertDateTime(ev.startDate, ev.startTime, ev.tz, timezone);
  const e = convertDateTime(ev.endDate, ev.endTime, ev.tz, timezone);

  let cur = new Date(s.full);
  cur.setUTCHours(0, 0, 0, 0);

  const last = new Date(e.full);
  last.setUTCHours(0, 0, 0, 0);

  while (cur.getTime() <= last.getTime()) {
    const curDate = getDateStringUTC(cur);
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
      cur.setUTCDate(cur.getUTCDate() + 1);
      continue;
    }

    if (!map.has(curDate)) map.set(curDate, []);
    map.get(curDate).push({
      title: ev.title,
      start: startHM,
      end: endHM,
      note: ev.note,
    });

    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/** ===== 구글 시트 fetch ===== */
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
      note: obj["노트"],
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

function shallowEqualArray(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (JSON.stringify(arr1[i]) !== JSON.stringify(arr2[i])) return false;
  }
  return true;
}

/** 선택 타임존의 "지금" 시각 (UTC만 사용) */
const getNowInTimezone = (timezone) => {
  const nowUTC = new Date(); // 내부적으로 UTC 기반
  // KST(+9)
  const kst = new Date(nowUTC);
  kst.setUTCHours(kst.getUTCHours() + 9);
  // 선택 타임존 상대 오프셋 적용
  const display = new Date(kst);
  display.setUTCHours(display.getUTCHours() + tzOffsets[timezone]);

  const yyyy = display.getUTCFullYear();
  const mm = String(display.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(display.getUTCDate()).padStart(2, "0");
  const HH = String(display.getUTCHours()).padStart(2, "0");
  const MM = String(display.getUTCMinutes()).padStart(2, "0");

  return {
    full: display,
    dateStr: `${yyyy}-${mm}-${dd}`,
    hm: `${HH}:${MM}`,
  };
};

export default function App() {
  const [timezone, setTimezone] = useState("PST");
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNote, setSelectedNote] = useState(null);

  // 현재 시간(선택 타임존 기준)
  const [nowInTZ, setNowInTZ] = useState(() => getNowInTimezone(timezone));

  // 오늘을 왼쪽에 스냅할지 여부 (스와이프 시 해제)
  const [snapToToday, setSnapToToday] = useState(true);

  /** ===== 데이터 자동 로드 + 변경 감지 ===== */
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
    timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, []);

  /** ===== 타임존 변경/주기적 갱신 시 now 업데이트 ===== */
  useEffect(() => {
    setNowInTZ(getNowInTimezone(timezone));
    const t = setInterval(() => setNowInTZ(getNowInTimezone(timezone)), 30000);
    return () => clearInterval(t);
  }, [timezone]);

  /** ===== 날짜별 이벤트 버킷 ===== */
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

  /** ===== 화면 크기에 따라 보여줄 일수 ===== */
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

  // 오늘을 왼쪽에 스냅 (여행 중이고 오늘이 일정에 포함될 때)
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

  /** ===== 시간 범위 계산 (현재 페이지에서만) ===== */
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
      setSnapToToday(false); // 사용자가 넘기면 스냅 해제
    },
    onSwipedRight: () => {
      setPage((p) => Math.max(p - 1, 0));
      setSnapToToday(false); // 사용자가 넘기면 스냅 해제
    },
    trackMouse: true,
  });

  const colors = ["bg-blue-200", "bg-green-200", "bg-yellow-200", "bg-purple-200", "bg-pink-200"];

  /** ===== 로딩 화면 ===== */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-400 border-t-transparent"></div>
      </div>
    );
  }

  /** 현재시간 라인 (선택 타임존의 오늘이 보이는 경우만) */
  const nowDateStr = nowInTZ.dateStr;
  const nowHM = nowInTZ.hm;
  const nowMin = toMinutes(nowHM);
  const canDrawNowLine = days.includes(nowDateStr) && nowMin >= dayStartHour * 60 && nowMin <= dayEndHour * 60;
  const nowTop = (nowMin - dayStartHour * 60) * PX_PER_MIN;

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
          onClick={() => {
            setTimezone((t) => (t === "KST" ? "PST" : "KST"));
            setSnapToToday(true); // 타임존 바꾸면 다시 오늘로 스냅
          }}
        >
          {timezone === "KST" ? "현지시간" : "한국시간"}
        </button>
      </header>

      {/* 날짜 헤더 */}
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

      {/* 본문 */}
      <div className="flex flex-1 overflow-y-auto">
        {/* 시간축 */}
        <div className="w-12 border-r border-gray-200 bg-gray-50 sticky left-0 z-10">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_HEIGHT }}>
              <span className="absolute top-1 right-1 text-[10px] text-gray-400">{h}:00</span>
            </div>
          ))}
        </div>

        {/* 이벤트 칼럼 */}
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
                {/* 현재시간 빨간 가로줄 */}
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

      {/* 노트 모달 */}
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
