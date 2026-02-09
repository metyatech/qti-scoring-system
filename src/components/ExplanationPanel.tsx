import React, { useId, useState } from 'react'

type ExplanationPanelProps = {
  html: string
}

export default function ExplanationPanel({ html }: ExplanationPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const contentId = useId()
  const toggle = () => setIsOpen((prev) => !prev)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      aria-controls={contentId}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className="mt-4 cursor-pointer rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-amber-800">解説</div>
        <span className="text-xs text-amber-700 underline hover:text-amber-900">
          {isOpen ? '解説を隠す' : '解説を表示'}
        </span>
      </div>
      {isOpen && <div id={contentId} className="mt-2" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
