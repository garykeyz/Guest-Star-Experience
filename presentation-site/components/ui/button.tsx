import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = cva("inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none", {
  variants: { variant: { default: "bg-primary text-primary-foreground hover:bg-primary/90" }, size: { default: "h-9 px-4 py-2", lg: "h-10 rounded-md px-6" } },
  defaultVariants: { variant: "default", size: "default" },
})

function Button({ className, variant = "default", size = "default", asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
