export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-[1.5rem]">
      {/* 메인 컨테이너 - body에서 480px 제한이 이미 걸려있음 */}
      <div className="w-full space-y-[2rem]">
        {/* 헤더 */}
        <div className="space-y-[0.5rem]">
          <h1 className="text-[2rem] font-bold tracking-tight text-foreground">
            Mingle
          </h1>
          <p className="text-[0.875rem] text-muted-foreground">
            가로 폭 정비례 반응형 데모
          </p>
        </div>

        {/* 반응형 스케일링 데모 카드 */}
        <div className="rounded-[0.75rem] border border-border bg-card p-[1.25rem] shadow-sm">
          <h2 className="mb-[0.75rem] text-[1.25rem] font-semibold text-card-foreground">
            📐 Responsive Scaling
          </h2>
          <p className="text-[0.875rem] leading-[1.5] text-muted-foreground">
            이 페이지의 모든 요소(글씨, 간격, 카드 크기 등)는 화면 가로 폭에
            정비례하여 커지고 작아집니다. 브라우저 창 너비를 조절해보세요.
          </p>
        </div>

        {/* 크기 비교 박스들 */}
        <div className="grid grid-cols-3 gap-[0.75rem]">
          {["Small", "Medium", "Large"].map((label, i) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center rounded-[0.625rem] border border-border bg-card p-[1rem]"
              style={{ minHeight: `${3 + i * 1.5}rem` }}
            >
              <span className="text-[1.5rem] font-bold text-foreground">
                {(i + 1) * 16}
              </span>
              <span className="text-[0.625rem] text-muted-foreground">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* 버튼들 */}
        <div className="flex flex-col gap-[0.75rem]">
          <button className="w-full rounded-[0.625rem] bg-primary px-[1.25rem] py-[0.75rem] text-[0.875rem] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            Primary Button
          </button>
          <button className="w-full rounded-[0.625rem] border border-border bg-secondary px-[1.25rem] py-[0.75rem] text-[0.875rem] font-medium text-secondary-foreground transition-opacity hover:opacity-90">
            Secondary Button
          </button>
        </div>

        {/* 타이포그래피 스케일 */}
        <div className="space-y-[0.5rem] rounded-[0.75rem] border border-border bg-card p-[1.25rem]">
          <h3 className="mb-[0.5rem] text-[1rem] font-semibold text-card-foreground">
            Typography Scale
          </h3>
          <p className="text-[2rem] font-bold leading-tight text-foreground">
            2rem Heading
          </p>
          <p className="text-[1.5rem] font-semibold text-foreground">
            1.5rem Subtitle
          </p>
          <p className="text-[1rem] text-foreground">1rem Body Text</p>
          <p className="text-[0.875rem] text-muted-foreground">
            0.875rem Secondary
          </p>
          <p className="text-[0.75rem] text-muted-foreground">
            0.75rem Caption
          </p>
        </div>

        {/* 현재 화면 정보 */}
        <div className="rounded-[0.75rem] border border-dashed border-border bg-muted/50 p-[1rem] text-center">
          <p className="text-[0.75rem] text-muted-foreground">
            기준 디자인 너비: 390px · 768px 이상에서 고정
          </p>
        </div>
      </div>
    </div>
  );
}
