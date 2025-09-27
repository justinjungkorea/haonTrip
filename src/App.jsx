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
const HOUR_HEIGHT = 60;
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

/** ===== 구글 시트 불러오기 ===== */
async function fetchSheet() {
  const url = import.meta.env.VITE_SHEET_URL; // .env 에 VITE_SHEET_URL 지정
  const res = await fetch(url);
  const text = await res.text();
  const rows = text.trim().split("\n");
  const header = rows[0].split(",").map((s) => s.trim());

  return rows.slice(1).map((line) => {
    const cols = line.split(",").map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] || ""));
    return {
      startDate: obj["시작일"],
      startTime: obj["시작시간"].padStart(5, "0"), // 9:00 → 09:00 보정
      endDate: obj["종료일"],
      endTime: obj["종료시간"].padStart(5, "0"),
      title: obj["제목"],
      tz: obj["타임존"],
    };
  });
}

export default function App() {
  const [timezone, setTimezone] = useState("KST");
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState([]);

  // ✅ 구글 시트에서 이벤트 불러오기
  useEffect(() => {
    fetchSheet().then(setEvents).catch(console.error);
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
  const totalPages = Math.max(1, dates.length - 1); // n일 → n-1 페이지
  const curPage = Math.min(page, totalPages - 1);
  const days = dates.slice(curPage, curPage + 2); // ✅ 슬라이딩 윈도우

  // 시간 범위 자동 계산
  const [dayStartHour, dayEndHour] = useMemo(() => {
    let min = 24 * 60;
    let max = 0;

    for (const arr of buckets.values()) {
      for (const ev of arr) {
        const s = toMinutes(ev.start);
        const e = toMinutes(ev.end);
        min = Math.min(min, s);
        max = Math.max(max, e);
      }
    }

    return [Math.floor(min / 60), Math.ceil(max / 60)];
  }, [buckets]);

  const hours = useMemo(() => {
    const arr = [];
    for (let h = dayStartHour; h <= dayEndHour; h++) arr.push(h);
    return arr;
  }, [dayStartHour, dayEndHour]);

  const dayHeightPx = (dayEndHour - dayStartHour) * HOUR_HEIGHT;

  const swipe = useSwipeable({
    onSwipedLeft: () => setPage((p) => Math.min(p + 1, totalPages - 1)),
    onSwipedRight: () => setPage((p) => Math.max(p - 1, 0)),
    trackMouse: true,
  });

  const calcBlockStyle = (startHM, endHM) => {
    const dayStartMin = dayStartHour * 60;
    const dayEndMin = dayEndHour * 60;

    let sMin = toMinutes(startHM);
    let eMin = toMinutes(endHM);

    const sClamped = Math.max(dayStartMin, Math.min(dayEndMin, sMin));
    const eClamped = Math.max(dayStartMin, Math.min(dayEndMin, eMin));
    if (eClamped <= sClamped) return null;

    const top = (sClamped - dayStartMin) * PX_PER_MIN;
    const height = Math.max(16, (eClamped - sClamped) * PX_PER_MIN);
    return { top, height };
  };

  const colors = ["bg-blue-200", "bg-green-200", "bg-yellow-200", "bg-purple-200", "bg-pink-200"];

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
          {timezone}
        </button>
      </header>

      {/* 날짜 헤더 */}
      <div className="flex border-b border-gray-200 bg-white shadow-sm">
        <div className="w-16" />
        {days.map((d) => (
          <div
            key={d}
            className="flex-1 text-center font-semibold py-3 border-b-2 border-transparent hover:border-blue-500 transition"
          >
            {formatDate(d)}
          </div>
        ))}
      </div>

      {/* 본문 */}
      <div className="flex flex-1 overflow-y-auto">
        {/* 시간축 */}
        <div className="w-16 border-r border-gray-200 bg-gray-50">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_HEIGHT }}>
              <span className="absolute -top-2 right-1 text-xs text-gray-400">{h}:00</span>
            </div>
          ))}
        </div>

        {/* 일정 칼럼 */}
        <div className="grid grid-cols-2 gap-2 flex-1 px-2 relative">
          {hours.map((h, i) => (
            <div
              key={`grid-${h}`}
              className="absolute left-0 right-0 border-t border-gray-100 pointer-events-none"
              style={{ top: i * HOUR_HEIGHT }}
            />
          ))}

          {days.map((date) => {
            const events = buckets.get(date) || [];
            return (
              <div
                key={date}
                className="relative border-l border-gray-100"
                style={{ height: dayHeightPx }}
              >
                {events.map((ev, idx) => {
                  const pos = calcBlockStyle(ev.start, ev.end);
                  if (!pos) return null;
                  const color = colors[idx % colors.length];
                  return (
                    <div
                      key={idx}
                      className={`absolute left-1 right-1 rounded-xl border border-gray-300 shadow-md p-2 transition transform hover:scale-105 hover:shadow-lg ${color}`}
                      style={{ top: pos.top, height: pos.height }}
                    >
                      <div className="text-xs font-bold text-gray-700">
                        {ev.start} ~ {ev.end}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 mt-1">
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
