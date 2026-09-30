"use client"

// Popover 原语 —— 表情选择器的桌面容器（UI-SPEC ## 交互契约 表情行：移动端 Sheet、
// 桌面 Popover）。本地实现（与 dialog.tsx / sheet.tsx 同一条理由：法定交互面的基座
// 自己拿着，不引未核验依赖 —— radix-ui 统一包里已有，不新增依赖）。

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { cn } from "cn"

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        className={cn(
          "z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md outline-hidden",
          className
        )}
        align={align}
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
