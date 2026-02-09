import { useLayoutEffect, useRef } from 'react'
import { autoResizeTextarea } from '@/utils/textarea'

interface AutoResizeTextareaProps {
  value: string
  onChange: (value: string) => void
  onBlur?: (value: string) => void
  className?: string
  rows?: number
}

export default function AutoResizeTextarea({
  value,
  onChange,
  onBlur,
  className,
  rows = 2,
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    autoResizeTextarea(ref.current)
  }, [value])

  return (
    <textarea
      ref={ref}
      className={className}
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onInput={() => autoResizeTextarea(ref.current)}
      onBlur={onBlur ? (event) => onBlur(event.target.value) : undefined}
      style={{ overflow: 'hidden', resize: 'none' }}
    />
  )
}
