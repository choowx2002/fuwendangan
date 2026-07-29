// Calculate difference in days (or any unit: 'second', 'minute', 'hour', 'month', 'year')
export function getRelativeTime(date: string) {
  const inputDate = new Date(date)
  const now = new Date()
  const diffInMs = inputDate.getTime() - now.getTime()
  const diffInSecs = Math.round(diffInMs / 1000)

  // Set up formatter
  const rtf = new Intl.RelativeTimeFormat('zh', { numeric: 'auto' })

  // Define time thresholds in seconds
  if (Math.abs(diffInSecs) < 60) {
    return rtf.format(diffInSecs, 'second')
  } else if (Math.abs(diffInSecs) < 3600) {
    return rtf.format(Math.round(diffInSecs / 60), 'minute')
  } else if (Math.abs(diffInSecs) < 86400) {
    return rtf.format(Math.round(diffInSecs / 3600), 'hour')
  } else {
    return rtf.format(Math.round(diffInSecs / 86400), 'day')
  }
}
