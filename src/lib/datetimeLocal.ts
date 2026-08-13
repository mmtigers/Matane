// <input type="datetime-local">/<input type="date">とISO文字列(visited_at)の相互変換。
// 文字列スライスではなくDateのローカルgetter/setterを使うことで、UTC境界をまたぐ
// 日時でも「見えている日付」とズレない。

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// ISO文字列 → <input type="datetime-local">のvalue("YYYY-MM-DDTHH:mm"、ローカル時刻)
export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
}

// <input type="datetime-local">のvalue → ISO文字列。ブラウザは値をローカル時刻として
// 解釈するため、new Date(value)でそのままローカル→UTC変換される。
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

// ISO文字列 → <input type="date">のvalue("YYYY-MM-DD"、ローカル日付)
export function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// <input type="date">で選んだ日付(ローカル)に、現在時刻(時・分・秒)を組み合わせてISO化する。
// 「後から記録する」で日付だけ選んだ場合に、不自然な00:00:00固定にならないようにするため。
export function isoFromDateKeepingCurrentTime(dateValue: string): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const now = new Date();
  const combined = new Date(
    year,
    month - 1,
    day,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds()
  );
  return combined.toISOString();
}
