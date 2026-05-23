import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "destructive";
  size?: "sm" | "md" | "lg";
}

const variantClass = {
  default:     "bg-blue-600 hover:bg-blue-700 text-white",
  ghost:       "hover:bg-white/5 text-muted-foreground hover:text-foreground",
  outline:     "border border-border hover:bg-white/5",
  destructive: "bg-red-600/20 hover:bg-red-600/30 text-red-400",
};

const sizeClass = {
  sm:  "text-xs px-2.5 py-1.5 rounded-md",
  md:  "text-sm px-3.5 py-2 rounded-md",
  lg:  "text-sm px-5 py-2.5 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
Button.displayName = "Button";
