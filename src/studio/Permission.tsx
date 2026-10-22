import { useT } from "../i18n";
import { IconCamera, IconLock, IconMic } from "../ui/icons";
import { KeyVisual } from "../ui/KeyVisual";
import { Button } from "../ui/primitives";
import type { PermissionState } from "./engine";

export function Permission({ state, onAllow }: { state: PermissionState; onAllow: () => void }) {
  const t = useT();
  const S = t.studio;
  const mobile = matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  const msg = state === "denied" ? S.permDenied : state === "insecure" ? S.permInsecure : state === "nodevice" ? S.permNoDevice : state === "unsupported" ? S.unsupported : null;
  return (
    <main className="screen permission">
      <div className="permission-card">
        <div className="row gap-4 permission-icons"><IconCamera width={28} height={28} /><IconMic width={28} height={28} /></div>
        <h1 className="heading-xxl">{S.permTitle}</h1>
        <p className="paragraph-l fg-2">{S.permText}</p>
        {mobile && <p className="paragraph-m permission-warn">{S.mobile}</p>}
        {msg && <p className="paragraph-m permission-warn" role="alert">{msg}</p>}
        <div className="row gap-5">
          <Button variant="record" size="l" onClick={onAllow} disabled={state === "asking" || state === "insecure" || state === "unsupported"}>
            {state === "denied" ? t.common.retry : S.permButton}
          </Button>
        </div>
        <p className="row gap-3 paragraph-s fg-3"><IconLock width={16} height={16} /> {t.landing.privacy[0]}</p>
      </div>
      <KeyVisual preset="small" side="right" unit="1.2vw" className="permission-kv" />
    </main>
  );
}
