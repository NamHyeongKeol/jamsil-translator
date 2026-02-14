'use client'

interface PhoneFrameProps {
  children: React.ReactNode
  className?: string
}

export default function PhoneFrame({ children, className = '' }: PhoneFrameProps) {
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {children}
    </div>
  )
}
