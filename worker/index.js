// Cloudflare Worker — 打卡回调处理
// 点击链接 → 更新 GitHub 状态文件

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function html(msg, date, period) {
  return `<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>打卡提醒</title></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5"><div style="background:white;border-radius:12px;padding:30px;max-width:400px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,.1)"><h2 style="margin:0 0 10px">${msg}</h2><p style="color:#666">${date} ${period === "morning" ? "上班打卡" : "下班打卡"}</p></div></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { searchParams: p } = url;
    const date = p.get("date");
    const period = p.get("period");
    const action = p.get("action");
    const token = p.get("token");

    // 验证
    if (token !== hash(date + period + env.CALLBACK_SECRET)) {
      return new Response("Invalid token", { status: 403 });
    }
    if (!["morning", "evening"].includes(period)) {
      return new Response("Invalid period", { status: 400 });
    }
    if (!["done", "notyet"].includes(action)) {
      return new Response("Invalid action", { status: 400 });
    }

    const GITHUB_REPO = "CDbadboy/checkin-reminder";
    const filePath = `status/${date}.json`;
    const newStatus = action === "done" ? "done" : "reminding";

    // 读现有文件
    let content = { date, morning: "pending", evening: "pending" };
    let sha = null;

    try {
      const getRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
        { headers: { Authorization: `token ${env.GITHUB_TOKEN}`, "User-Agent": "checkin-reminder" } }
      );
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
        content = JSON.parse(atob(data.content));
      }
    } catch (e) {
      // 文件不存在
    }

    // 更新状态
    content[period] = newStatus;
    content.lastUpdate = new Date().toISOString();

    // 写回
    const body = {
      message: `✅ ${date} ${period}=${newStatus}`,
      content: btoa(JSON.stringify(content, null, 2)),
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
      {
        method: "PUT",
        headers: { Authorization: `token ${env.GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "checkin-reminder" },
        body: JSON.stringify(body),
      }
    );

    if (putRes.ok) {
      const msg = action === "done" ? "✅ 已打卡，不再提醒" : "⏰ 还没打，3分钟后继续提醒";
      return new Response(html(msg, date, period), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } else {
      const err = await putRes.text();
      return new Response(`GitHub API error: ${err.slice(0, 500)}`, { status: 500 });
    }
  },
};
