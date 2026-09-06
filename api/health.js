module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false }); }
  return res.status(200).json({ ok: true, service: "editions-perspectives-checkout" });
};
