'use client'

const PHONE_BASE_WIDTH = 480

interface PhoneFrameProps {
  children: React.ReactNode
  className?: string
}

export default function PhoneFrame({ children, className = '' }: PhoneFrameProps) {
  return (
    <div className={`relative mx-auto h-full w-full overflow-hidden ${className}`} style={{ maxWidth: PHONE_BASE_WIDTH }}>
      {children}
    </div>
  )
}
