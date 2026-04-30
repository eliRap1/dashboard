export async function postWebhook(url: string, payload: any): Promise<boolean> {
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (res.ok) return true;
    } catch { /* retry */ }
    if (attempt === 0) await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
