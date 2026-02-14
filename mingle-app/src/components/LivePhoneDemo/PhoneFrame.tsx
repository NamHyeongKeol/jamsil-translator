'use client'

const PHONE_BASE_WIDTH = 480

interface PhoneFrameProps {
  children: React.ReactNode
  className?: string
}

export default function PhoneFrame({ children, className = '' }: PhoneFrameProps) {
  return (
    <div className={`relative mt-4 mx-auto w-full ${className}`} style={{ maxWidth: PHONE_BASE_WIDTH }}>
      <div className="relative overflow-hidden rounded-[1.4rem] border border-amber-200/70 bg-white shadow-sm">
        {children}
      </div>
    </div>
  )
}
