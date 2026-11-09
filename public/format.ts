export const count = (n: number) => n.toLocaleString()
export function duration(minutes: number) {
  if (!Number.isFinite(minutes))
    return 'Unknown'
  if (minutes === 0)
    return 'Off'
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return `${minutes / 1440} ${minutes === 1440
      ? 'day'
      : 'days'}`
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} ${minutes === 60
      ? 'hour'
      : 'hours'}`
  }
  return `${count(minutes)} ${minutes === 1
    ? 'minute'
    : 'minutes'}`
}
function relativeTime(date: string) {
  const delta = Date.now() - new Date(date).getTime()
  if (!Number.isFinite(delta))
    return 'Unknown'
  const absolute = Math.abs(delta)
  const unit = absolute < 60000
    ? 'second'
    : absolute < 3600000
      ? 'minute'
      : absolute < 86400000
        ? 'hour'
        : 'day'
  const divisor = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: 86400000,
  }[unit]
  const rtf = new Intl.RelativeTimeFormat(navigator.language, { numeric: 'auto' })
  return rtf.format(Math.round(-delta / divisor), unit)
}
export function formatScanAge(date: string) {
  const exact = new Intl.DateTimeFormat(navigator.language, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(date))
  return {
    label: relativeTime(date),
    exact,
  }
}
