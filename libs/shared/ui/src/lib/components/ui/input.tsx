import * as React from "react"
import { cn } from "../../utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onWheel, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full rounded-xl border border-border dark:border-white/5 bg-background dark:bg-white/[2%] dark:backdrop-blur-md px-4 py-2 text-sm font-semibold dark:text-white/90 dark:font-medium ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition-all disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        // Number inputs steal the mouse-wheel scroll to bump their value by
        // `step` (native browser behavior) — easy to trigger by accident
        // while scrolling a form full of them. Blur on wheel so the page
        // scrolls normally instead of silently mutating the value.
        onWheel={(e) => {
          if (type === "number") {
            e.currentTarget.blur();
          }
          onWheel?.(e);
        }}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
