import { useEffect, useRef } from 'react'
import { scheduleHighlightCodeBlocks } from '@/utils/highlight'

type UseHighlightDeps = ReadonlyArray<unknown>

export const useHighlightCodeBlocks = (
  rootRef: React.RefObject<ParentNode | null>,
  deps: UseHighlightDeps,
  enabled = true,
) => {
  const rafRef = useRef<number | null>(null)
  const scheduleRef = useRef<ReturnType<typeof scheduleHighlightCodeBlocks> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    if (!root) return

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
    }
    if (scheduleRef.current) {
      scheduleRef.current.cancel()
      scheduleRef.current = null
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      scheduleRef.current = scheduleHighlightCodeBlocks(root)
    })

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (scheduleRef.current) {
        scheduleRef.current.cancel()
        scheduleRef.current = null
      }
    }
  }, [enabled, rootRef, deps])
}
