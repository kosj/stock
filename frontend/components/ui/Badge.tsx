import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "green" | "red" | "yellow" | "blue";
}

const variantClass = {
  default: "bg-white/10 text-foreground",
  green:   "bg-green-500/15 text-green-400",
  red:     "bg-red-500/15 text-red-400",
  yellow:  "bg-yellow-500/15 text-yellow-400",
  blue:    "bg-blue-500/15 text-blue-400",
};

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variantClass[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
