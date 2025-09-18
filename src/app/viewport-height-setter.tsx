'use client'

import { useEffect } from 'react'

export function ViewportHeightSetter() {
  useEffect(() => {
    const setFullHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      document.documentElement.style.setProperty('--full-height', `${window.innerHeight}px`);
    };

    setFullHeight();
    window.addEventListener('resize', setFullHeight);
    return () => window.removeEventListener('resize', setFullHeight);
  }, []);

  return null;
}