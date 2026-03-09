type MingleWordmarkProps = {
  className?: string;
};

const DEFAULT_CLASS_NAME = [
  "inline-block shrink-0 select-none bg-gradient-to-r from-amber-500 to-orange-500",
  "bg-clip-text text-[2.05rem] font-extrabold leading-[1.08] tracking-tight text-transparent",
].join(" ");

export default function MingleWordmark({
  className,
}: MingleWordmarkProps) {
  const resolvedClassName = className
    ? `${DEFAULT_CLASS_NAME} ${className}`
    : DEFAULT_CLASS_NAME;

  return <span className={resolvedClassName}>Mingle</span>;
}
