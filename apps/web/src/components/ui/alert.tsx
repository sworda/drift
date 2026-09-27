import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Alert 原语 —— 危机干预关怀卡片的容器基座（UI-SPEC ## Component Inventory 的
// `alert` 行）。与气泡原语是**两个组件**：这一区分就是 R1.24「安全覆写不得伪装成
// 角色的自然发言」在组件层的落实 —— 关怀内容只能长在这里，而这里是全宽块形态，
// 没有尾巴、没有头像、没有 80% 宽度上限，在视觉上不可能被读成一条角色发言。

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] gap-x-3 has-[>svg]:gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground border-border",
        destructive: "text-destructive bg-destructive/10 border-destructive/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      data-variant={variant}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className="col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight"
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className="col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed"
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }