import { ComponentType } from 'react'
import HeroSection from '@/components/sections/HeroSection'
import ValuePropositionSection from '@/components/sections/ValuePropositionSection'
import ProblemSection from '@/components/sections/ProblemSection'
import FeaturesSection from '@/components/sections/FeaturesSection'
import RealtimeSyncSection from '@/components/sections/RealtimeSyncSection'
import CoreValueSection from '@/components/sections/CoreValueSection'
import TalkToWorldSection from '@/components/sections/TalkToWorldSection'
import CTASection from '@/components/sections/CTASection'

// 섹션이 받을 수 있는 공통 props
// openModal과 version은 필요한 컴포넌트만 사용하고, 나머지는 무시됨
export interface SectionCommonProps {
  openModal: (buttonType: string) => void
  version?: string
}

// 섹션 컴포넌트 레지스트리
// 새로운 섹션을 추가할 때 여기에 등록하면 됨
export const sectionRegistry: Record<string, ComponentType<SectionCommonProps>> = {
  hero: HeroSection as ComponentType<SectionCommonProps>,
  valueProposition: ValuePropositionSection as ComponentType<SectionCommonProps>,
  problem: ProblemSection as ComponentType<SectionCommonProps>,
  features: FeaturesSection as ComponentType<SectionCommonProps>,
  realtimeSync: RealtimeSyncSection as ComponentType<SectionCommonProps>,
  coreValue: CoreValueSection as ComponentType<SectionCommonProps>,
  talkToWorld: TalkToWorldSection as ComponentType<SectionCommonProps>,
  cta: CTASection as ComponentType<SectionCommonProps>,
}

export type SectionId = keyof typeof sectionRegistry

export interface SectionConfig {
  id: string  // sectionRegistry의 키
}

export interface VersionConfig {
  sections: SectionConfig[]
}

// 버전별 섹션 구성 정의
// 섹션 순서를 바꾸거나, 특정 섹션을 제거하거나, 새 섹션을 추가할 수 있음
export const versionConfigs: Record<string, VersionConfig> = {
  // 기본 버전 - 현재와 동일한 순서
  normal: {
    sections: [
      { id: 'hero' },
      { id: 'valueProposition' },
      { id: 'problem' },
      { id: 'features' },
      { id: 'realtimeSync' },
      { id: 'coreValue' },
      { id: 'talkToWorld' },
      { id: 'cta' },
    ]
  },
  // flirting 버전 - 현재는 normal과 동일 (i18n만 다름)
  flirting: {
    sections: [
      { id: 'hero' },
      { id: 'valueProposition' },
      { id: 'problem' },
      { id: 'features' },
      { id: 'realtimeSync' },
      { id: 'coreValue' },
      { id: 'talkToWorld' },
      { id: 'cta' },
    ]
  },
  // working 버전 - 현재는 normal과 동일 (i18n만 다름)
  working: {
    sections: [
      { id: 'hero' },
      { id: 'valueProposition' },
      { id: 'problem' },
      { id: 'features' },
      { id: 'realtimeSync' },
      { id: 'coreValue' },
      { id: 'talkToWorld' },
      { id: 'cta' },
    ]
  },
}

// 기본 설정 - 알 수 없는 버전일 때 fallback
export const defaultVersion = 'normal'
