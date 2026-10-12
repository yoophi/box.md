import { useState } from "react";
import type { AppInfo } from "@box/contracts";
import { Button } from "@box/ui";
import { getAppInfo } from "@/entities/app-info";
import { isDesktop } from "@/shared/lib/runtime";

export function CheckRuntime() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setPending(true);
    setError(null);
    try { setInfo(await getAppInfo()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }

  if (!isDesktop()) return <p className="runtime-note">브라우저 미리보기</p>;
  return (
    <div className="runtime">
      <Button onClick={check} disabled={pending}>{pending ? "확인 중…" : "앱 정보 확인"}</Button>
      <p className="runtime-note" role="status" aria-live="polite">
        {error ?? (info ? `${info.name} · v${info.version} · ${info.platform}` : "")}
      </p>
    </div>
  );
}
