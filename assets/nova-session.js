(async function verifyNovaSession() {
  const query = new URLSearchParams(location.search);
  if (query.get("multiplayer") !== "1") return;
  try {
    const response = await fetch("/api/sso/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Ghost Chat session required");
    window.NovaPilot = await response.json();
  } catch {
    const returnUrl = encodeURIComponent(location.href);
    location.replace(`https://crea-doc.fr/chat/?nova_return=${returnUrl}`);
  }
})();

