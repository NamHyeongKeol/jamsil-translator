interface PhoneFrameProps {
  children: React.ReactNode
  className?: string
}

export default function PhoneFrame({ children, className = '' }: PhoneFrameProps) {
  return (
    <div className={`relative mt-10 mx-auto w-[90vw] max-w-[360px] md:w-[360px] md:max-w-none lg:w-[320px] ${className}`}>
      {/* Outer bezel */}
      <div className="bg-gray-900 rounded-[2.5rem] md:rounded-[3rem] p-[6px] shadow-2xl">
        {/* Screen */}
        <div className="relative bg-white rounded-[2.2rem] md:rounded-[2.6rem] overflow-hidden">
          {/* Dynamic Island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-gray-900 rounded-full w-24 h-6 md:w-28 md:h-7 z-20" />
          {children}
        </div>
      </div>
    </div>
  )
}
