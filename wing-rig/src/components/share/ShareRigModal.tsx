import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Info,
  Lock,
  Monitor,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { RigDocument } from '../../schema/rig';
import {
  buildEmbeddedShareUrl,
  buildKioskReadOnlyUrl,
  type ShareUrlResult,
} from '../../store/shareLink';

interface ShareRigModalProps {
  rig: RigDocument;
  stagedCount: number;
  onClose: () => void;
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy fallback
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function ShareRigModal({ rig, stagedCount, onClose }: ShareRigModalProps) {
  const [shareResult, setShareResult] = useState<ShareUrlResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'share' | 'kiosk' | null>(null);

  const kioskUrl =
    typeof window !== 'undefined' ? buildKioskReadOnlyUrl(window.location.href) : '?mode=view';

  useEffect(() => {
    let active = true;
    setBuildError(null);
    const baseHref = typeof window !== 'undefined' ? window.location.href : 'https://example.com/';

    void buildEmbeddedShareUrl(rig, baseHref)
      .then((res) => {
        if (active) setShareResult(res);
      })
      .catch((err) => {
        if (active) {
          setBuildError(err instanceof Error ? err.message : 'Could not build share link.');
        }
      });

    return () => {
      active = false;
    };
  }, [rig]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCopy = async (text: string, key: 'share' | 'kiosk') => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? null : cur));
      }, 2400);
    }
  };

  const compressionPct =
    shareResult && shareResult.rawJsonLength > 0
      ? Math.max(0, Math.round((1 - shareResult.payloadLength / shareResult.rawJsonLength) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-rig-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/70 backdrop-blur-xs p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              style={{ clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)' }}
              className="flex h-8 w-8 shrink-0 items-center justify-center bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950"
            >
              <Share2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="share-rig-modal-title"
                className="font-display text-sm font-bold text-slate-900 dark:text-slate-100"
              >
                Share Read-Only View
              </h2>
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                Let others inspect, trace &amp; print your current rig with all editing locked out.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close share dialog"
            onClick={onClose}
            className="rounded-[2px] p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Snapshot Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b111d] px-3 py-2.5">
            <div className="min-w-0">
              <div className="font-display text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                {rig.name}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                {rig.nodes.length} devices · {rig.trunks.length} trunks · {rig.sourceSnapshots.length}{' '}
                .snap sync{rig.sourceSnapshots.length === 1 ? '' : 's'}
                {stagedCount > 0
                  ? ` · includes ${stagedCount} staged patch${stagedCount === 1 ? '' : 'es'}`
                  : ''}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[1px] border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="w-3 h-3" />
              Zero Uploads
            </span>
          </div>

          {/* Primary: Self-Contained Share Link */}
          <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]/50 p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                    Self-Contained Read-Only Link
                  </h3>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Your current layout, friendly labels, cable tags, notes, and patch data are
                  compressed right inside the link fragment. Opening it never modifies the
                  recipient&apos;s browser storage.
                </p>
              </div>
              {shareResult && (
                <span className="shrink-0 rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  {formatByteCount(shareResult.url.length)}
                  {shareResult.compressed && compressionPct > 0 ? ` (−${compressionPct}%)` : ''}
                </span>
              )}
            </div>

            {buildError ? (
              <div className="rounded-[2px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                {buildError}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  readOnly
                  aria-label="Read-only share link"
                  value={shareResult ? shareResult.url : 'Generating compressed link...'}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090d14] px-2.5 py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 focus:border-sky-600 focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!shareResult}
                    onClick={() => shareResult && void handleCopy(shareResult.url, 'share')}
                    className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                      copiedKey === 'share'
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950'
                        : 'bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
                    }`}
                  >
                    {copiedKey === 'share' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Link!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Read-Only Link</span>
                      </>
                    )}
                  </button>

                  {shareResult && (
                    <a
                      href={shareResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Preview in New Tab</span>
                    </a>
                  )}
                </div>

                {shareResult && shareResult.url.length > 4000 && (
                  <div className="flex items-start gap-2 rounded-[2px] border border-sky-200/80 dark:border-sky-900/80 bg-sky-50/70 dark:bg-sky-950/40 px-2.5 py-2 text-[11px] text-sky-900 dark:text-sky-200">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
                    <span>
                      This link carries the full rig snapshot ({shareResult.url.length.toLocaleString()}{' '}
                      chars) with no server required. Some SMS/chat apps truncate very long raw URLs
                      — pasting it as a hyperlink or sending via email works best.
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Viewer permissions breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="rounded-[2px] bg-slate-50 dark:bg-[#0b111d] border border-slate-200/80 dark:border-slate-800 p-2.5">
                <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  <Eye className="w-3 h-3" />
                  Viewers Can
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <li>• Pan &amp; zoom the schematic</li>
                  <li>• Inspect 1–48 channel patch lists</li>
                  <li>• Search &amp; Click-to-Trace signals</li>
                  <li>• Open Print / PDF view</li>
                </ul>
              </div>
              <div className="rounded-[2px] bg-slate-50 dark:bg-[#0b111d] border border-slate-200/80 dark:border-slate-800 p-2.5">
                <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <Lock className="w-3 h-3" />
                  Locked Out
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <li>• Edit Mode toggle &amp; node dragging</li>
                  <li>• Label, cable tag &amp; note editing</li>
                  <li>• Add Gear, Import .snap &amp; Reset</li>
                  <li>• Patch Studio &amp; .rig.json import/export</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Secondary: Booth / Device Kiosk Read-Only Link */}
          <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0b111d]/80 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  Booth / Volunteer Kiosk URL
                </h3>
              </div>
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                ?mode=view
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Short URL for locking a sound-booth iPad or volunteer computer into Read-Only mode
              using the rig already saved on that device.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                aria-label="Booth kiosk read-only URL"
                value={kioskUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#090d14] px-2.5 py-1 font-mono text-[11px] text-slate-700 dark:text-slate-300 focus:border-sky-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleCopy(kioskUrl, 'kiosk')}
                className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                {copiedKey === 'kiosk' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <a
                href={kioskUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open kiosk read-only URL in new tab"
                className="inline-flex shrink-0 items-center justify-center rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-200 dark:border-slate-800 px-5 py-3 bg-slate-50/60 dark:bg-[#0b111d]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
