export async function onRequestGet(context) {
  const key = context.env.STOREGIT_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ key }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
