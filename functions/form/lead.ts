const html = (s: string, status = 200) =>
  new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export const onRequestGet: PagesFunction = async () => {
  return html(`<!doctype html>
<html lang="ja"><meta charset="utf-8">
<title>Lead Form</title>
<body>
  <h1>Lead Form</h1>
  <form method="post" action="/form/lead">
    <label>名前 <input name="name" required></label><br/>
    <label>電話 <input name="tel"></label><br/>
    <label>メール <input name="email" type="email"></label><br/>
    <label>メモ <textarea name="note"></textarea></label><br/>
    <button type="submit">送信</button>
  </form>
</body></html>`);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const form = await request.formData();
  const payload = Object.fromEntries(form.entries());
  // /api/add-lead に転送
  const resp = await fetch(new URL("/api/add-lead", new URL(request.url).origin).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await resp.text();
  return html(`<pre>${resp.status} ${resp.statusText}\n${body}</pre>`, resp.ok ? 200 : resp.status);
};

export const onRequestOptions = () => new Response(null, { status: 204 });
