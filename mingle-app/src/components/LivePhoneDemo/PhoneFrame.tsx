'use client'

import { useState, useEffect, useRef } from 'react'

const PHONE_BASE_WIDTH = 320 // 기본(PC) 폰 너비 (px)

interface PhoneFrameProps {
  children: React.ReactNode
  className?: string
}

export default function PhoneFrame({ children, className = '' }: PhoneFrameProps) {
  const [scale, setScale] = useState(1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const phoneRef = useRef<HTMLDivElement>(null)
  const [innerHeight, setInnerHeight] = useState(0)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const phone = phoneRef.current
    if (!wrapper || !phone) return

    const update = () => {
      // 부모 컨테이너의 너비를 기준으로 스케일 계산
      const parentWidth = wrapper.parentElement?.clientWidth || window.innerWidth
      setScale(Math.min(1, parentWidth / PHONE_BASE_WIDTH))
      setInnerHeight(phone.offsetHeight)
    }

    update()
    const parent = wrapper.parentElement
    if (parent) {
      const ro = new ResizeObserver(update)
      ro.observe(parent)
      return () => ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={`relative mt-10 mx-auto ${className}`}
      style={{
        width: PHONE_BASE_WIDTH * scale,
        height: innerHeight ? innerHeight * scale : 'auto',
      }}
    >
      <div
        ref={phoneRef}
        style={{
          width: PHONE_BASE_WIDTH,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {/* Outer bezel */}
        <div className="bg-gray-900 rounded-[3rem] p-[6px] shadow-2xl">
          {/* Screen */}
          <div className="relative bg-white rounded-[2.6rem] overflow-hidden">
            {/* Dynamic Island */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-gray-900 rounded-full w-28 h-7 z-20" />
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
