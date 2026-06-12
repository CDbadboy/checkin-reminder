// Vercel Serverless Function — 处理打卡按钮回调
// 点击链接 → 更新 GitHub 仓库中的状态文件

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "CDbadboy/checkin-reminder";
const SECRET = process.env.CALLBACK_SECRET || "checkin2026";

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

export default async function handler(req, res) {
  const { date, period, action, token } = req.query;

  // 安全验证
  if (token !== hash(date + period + SECRET)) {
    return res.status(403).json({ error: "invalid token" });
  }
  if (!["morning", "evening"].includes(period)) {
    return res.status(400).json({ error: "invalid period" });
  }
  if (!["done", "notyet"].includes(action)) {
    return res.status(400).json({ error: "invalid action" });
  }

  const filePath = `status/${date}.json`;
  const newStatus = action === "done" ? "done" : "reminding";

  // 读现有文件
  let content = { date, morning: "pending", evening: "pending" };
  let sha = null;

  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "checkin-reminder" } }
    );
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
      content = JSON.parse(Buffer.from(data.content, "base64").toString());
    }
  } catch (e) {
    // 文件不存在，用默认值
  }

  // 更新状态
  content[period] = newStatus;
  content.lastUpdate = new Date().toISOString();

  // 写回 GitHub
  const body = { message: `✅ ${date} ${period}=${newStatus}`, content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64") };
  if (sha) body.sha = sha;

  const putRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: "PUT",
      headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "checkin-reminder" },
      body: JSON.stringify(body),
    }
  );

  if (putRes.ok) {
    const msg = action === "done" ? "已打卡，不再提醒 ✅" : "还没打，3分钟后继续提醒 ⏰";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>${msg}</h2><p>${date} ${period === "morning" ? "上班" : "下班"}</p></body></html>`);
  } else {
    const err = await putRes.text();
    return res.status(500).json({ error: "github api failed", detail: err.slice(0, 200) });
  }
}
