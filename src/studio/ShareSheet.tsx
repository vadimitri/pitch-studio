// After "Share": the take is saved in this browser and gets a review page. Here you copy the link, look at the
// page as your team would, or download the video. The demo says plainly that the link only opens on this device.
import { useState } from "react";
import { useT } from "../i18n";
import { extFor } from "../lib/media/recorder";
import { href, navigate } from "../lib/router";
import type { Take } from "../lib/types";
import { IconArrowRight, IconCheck, IconDownload, IconInfo, IconLink } from "../ui/icons";
import { Button } from "../ui/primitives";
import { downloadBlob } from "./media-helpers";

export function ShareSheet({ take, ready, onClose }: { take: Take; ready: boolean; onClose: () => void }) {
  const t = useT();
  const R = t.replay;
  const [copied, setCopied] = useState(false);
  const link = new URL(href(`/review/${take.id}?view=reviewer`), location.href).href;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="heading-l">{R.shareTitle(take.n)}</h2>
        <p className="paragraph-m fg-2">{R.shareText}</p>
        <div className="share-link">
          <input className="share-input mono-xs" value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
          <Button variant="primary" size="m" icon={copied ? <IconCheck width={16} height={16} /> : <IconLink width={16} height={16} />} onClick={() => void copy()}>
            {copied ? R.copied : R.copy}
          </Button>
        </div>
        <div className="row gap-3 sheet-actions">
          <Button variant="secondary" iconRight={<IconArrowRight width={16} height={16} />} disabled={!ready} onClick={() => navigate(`/review/${take.id}?view=reviewer`)}>{ready ? R.openTeam : R.saving}</Button>
          <Button variant="ghost" icon={<IconDownload width={16} height={16} />} onClick={() => downloadBlob(take.video, `pitch-studio-take-${take.n}.${extFor(take.mime)}`)}>{t.common.download}</Button>
          <Button variant="ghost" onClick={onClose}>{t.common.close}</Button>
        </div>
        <p className="sheet-demo paragraph-xs"><IconInfo width={14} height={14} /> {R.shareDemo}</p>
      </div>
    </div>
  );
}
