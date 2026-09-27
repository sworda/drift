"use client"

// Sheet 原语（UI-SPEC ## Component Inventory 的 `sheet` 行）—— 聊天页「更多」
// 菜单（含「结束本次会话」）与移动端表情选择器的容器。本地实现，理由同
// dialog.tsx（法定交互面的基座自己拿着；不引未核验依赖）。

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "cn"

function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay(props: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50", props.className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "bottom",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card text-card-foreground shadow-lg transition",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[70dvh] rounded-t-lg border-t border-border p-4",
          side === "top" && "inset-x-0 top-0 rounded-b-lg border-b border-border p-4",
          side === "right" && "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l border-border p-4",
          side === "left" && "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r border-border p-4",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader(props: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1", props.className)} {...props} />
}

function SheetTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn("text-base font-medium", props.className)} {...props} />
}

function SheetDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="sheet-description" className={cn("text-label text-text-secondary", props.className)} {...props} />
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetOverlay, SheetPortal, SheetTitle, SheetTrigger }
