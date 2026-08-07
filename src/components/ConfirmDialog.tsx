"use client";

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// window.confirm()の代替。ネイティブダイアログはアプリのダークUIから浮いて見え
// スタイル制御もできないため、既存の5秒アンドゥ・スナックバーと同系統の
// カスタムモーダルに統一する。
export function ConfirmDialog({
  open,
  message,
  confirmLabel = "削除する",
  cancelLabel = "キャンセル",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={message}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm text-neutral-900">{message}</p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-full bg-red-500 py-3 text-sm font-semibold text-white focus:ring-2 focus:ring-amber-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
