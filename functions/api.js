function noStore(extra = {}) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, max-age=0, must-revalidate',
    pragma: 'no-cache',
    'x-store': 'd1',
    ...extra,
  };
}

function okJSON(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: noStore(headers) });
}

async function requireAdmin(request, env) {
  const key = request.headers.get('x-admin-key') || '';
  if (!key || key !== env.ADMIN) {
    return { error: new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: noStore() }) };
  }
  return {};
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // 管理系はすべて認証
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  try {
    switch (action) {
      case 'listLeads': {
        const tenant = url.searchParams.get('tenant') ?? '';
        const toolId = url.searchParams.get('toolId');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);
        const from  = url.searchParams.get('from') || '1970-01-01T00:00:00Z';

        const sql = `
          SELECT id, toolId, name, email, createdAt, tenant
          FROM leads
          WHERE tenant = ?1
            AND datetime(createdAt) >= datetime(?2)
            ${toolId ? 'AND toolId = ?3' : ''}
          ORDER BY datetime(createdAt) DESC
          LIMIT ?${toolId ? 4 : 3}
        `;
        const args = toolId ? [tenant, from, toolId, limit] : [tenant, from, limit];
        const { results: items } = await env.DB.prepare(sql).bind(...args).all();
        return okJSON({ ok: true, items });
      }

      case 'exportLeads': {
        const tenant = url.searchParams.get('tenant') ?? '';
        const { results: items } = await env.DB.prepare(`
          SELECT id, toolId, name, email, createdAt, tenant
          FROM leads
          WHERE tenant = ?1
          ORDER BY datetime(createdAt) DESC
        `).bind(tenant).all();

        const header = 'id,toolId,name,email,createdAt,tenant\n';
        const rows = items.map(r => [r.id, r.toolId, r.name, r.email, r.createdAt, r.tenant]
          .map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

        return new Response(header + rows, {
          status: 200,
          headers: noStore({ 'content-type': 'text/csv; charset=utf-8' })
        });
      }

      case 'deleteLead': {
        if (request.method !== 'POST') return okJSON({ ok: false, error: 'POST only' }, 405);
        const body = await request.json().catch(() => ({}));
        const { tenant = '', id = '' } = body;
        if (!id) return okJSON({ ok: false, error: 'id required' }, 400);
        await env.DB.prepare(`DELETE FROM leads WHERE tenant = ?1 AND id = ?2`).bind(tenant, id).run();
        return okJSON({ ok: true, deleted: 1, id });
      }

      // 診断用（必要時だけ使う）
      case 'diag': {
        const tenant = url.searchParams.get('tenant') ?? '';
        const { results } = await env.DB.prepare(
          `SELECT COUNT(*) as c, MIN(createdAt) as minC, MAX(createdAt) as maxC FROM leads WHERE tenant = ?1`
        ).bind(tenant).all();
        return okJSON({ ok: true, store: 'd1', count: results[0]?.c || 0, min: results[0]?.minC, max: results[0]?.maxC });
      }

      default:
        return okJSON({ ok: false, error: 'unknown action' }, 400);
    }
  } catch (err) {
    return okJSON({ ok: false, error: String(err?.message || err) }, 500);
  }
}
