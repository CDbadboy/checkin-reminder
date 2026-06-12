// GitHub Actions 脚本 — 检查工作日+打卡状态，发微信提醒
const fs = require("fs");
const crypto = require("crypto");

const SENDKEY = process.env.SENDKEY;
const CALLBACK_URL = process.env.CALLBACK_URL;
const SECRET = process.env.CALLBACK_SECRET || "checkin2026";

function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex").slice(0, 8);
}

function getCST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

function getDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function getPeriod(cst) {
  const h = cst.getHours();
  const m = cst.getMinutes();
  // 上班窗口 8:50-10:00
  if ((h === 8 && m >= 50) || h === 9) return "morning";
  // 下班窗口 17:30-18:30
  if (h === 17 || (h === 18 && m <= 30)) return "evening";
  return null;
}

async function isWorkday(dateStr) {
  try {
    const res = await fetch(`https://timor.tech/api/holiday/info/${dateStr}`);
    const data = await res.json();
    if (data.code === 0) {
      // type: 0=工作日 1=周末 2=节假日 3=调休工作日
      const t = data.type.type;
      return t === 0 || t === 3;
    }
  } catch (e) {
    console.error("Holiday API failed:", e.message);
    // fallback: check if weekday (Mon-Fri)
    const d = new Date(dateStr);
    const day = d.getDay();
    return day >= 1 && day <= 5;
  }
  return true; // fallback
}

function readStatus(dateStr) {
  const path = `status/${dateStr}.json`;
  try {
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, "utf-8"));
    }
  } catch (e) {
    // ignore
  }
  return { date: dateStr, morning: "pending", evening: "pending" };
}

async function sendNotification(dateStr, period, status) {
  const label = period === "morning" ? "上班" : "下班";
  const timeLabel = period === "morning" ? "8:50" : "17:30";
  const remindCount = status._remindCount || 0;
  const remindNote = remindCount > 0 ? `\n\n> 已提醒 ${remindCount + 1} 次` : "";

  const token = hash(dateStr + period + SECRET);
  const doneUrl = `${CALLBACK_URL}?date=${dateStr}&period=${period}&action=done&token=${token}`;
  const notyetUrl = `${CALLBACK_URL}?date=${dateStr}&period=${period}&action=notyet&token=${token}`;

  const desp = `## ⏰ 交建通${label}打卡提醒

> ${dateStr} ${timeLabel}
> 请确认是否已打卡${remindNote}

---

### [✅ 已打卡](${doneUrl})

### [❌ 还没打](${notyetUrl})

---

_3-5 分钟后再次提醒_
`;

  try {
    const res = await fetch(`https://sctapi.ftqq.com/${SENDKEY}.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: `⏰ 交建通${label}打卡提醒`, desp }),
    });
    const data = await res.json();
    console.log(`Notification sent for ${period}:`, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`Failed to send notification:`, e.message);
    return false;
  }
}

async function main() {
  const cst = getCST();
  const dateStr = getDateStr(cst);
  const period = getPeriod(cst);

  console.log(`CST: ${cst.toISOString()}, date: ${dateStr}, period: ${period || "none"}`);

  // 不在提醒窗口
  if (!period) {
    console.log("Not in reminder window, exiting.");
    return;
  }

  // 检查工作日
  const workday = await isWorkday(dateStr);
  if (!workday) {
    console.log(`Not a workday (${dateStr}), exiting.`);
    return;
  }

  // 读状态
  const status = readStatus(dateStr);

  // 已打卡，不发
  if (status[period] === "done") {
    console.log(`${period} already done, exiting.`);
    return;
  }

  // 发通知
  status._remindCount = (status._remindCount || 0) + 1;
  await sendNotification(dateStr, period, status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
