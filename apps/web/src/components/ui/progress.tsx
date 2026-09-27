// Progress —— 服务端驱动的进度指示（UI-SPEC loading E9/E10）。
//
// 自绘而不引 @radix-ui/react-progress：唯一的消费者是删除执行中与导出打包中
// 两个「等待服务端作业」的场景，语义是「占位 + 进行中」，不是「已知百分比」
//（服务端不给百分比 —— 给了也是编的）。indeterminate 动画由 CSS 承担。
//
// ⚠️ aria：role="progressbar" 且无 aria-valuenow —— indeterminate 进度条的正确
// 形态（一个带 valuenow 的假百分比比没有百分比更骗人）。

export interface ProgressProps {
  /** 可访问名称（aria-label）。 */
  readonly label: string;
}

export function Progress({ label }: ProgressProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      data-testid="progress"
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full w-1/3 animate-[progress-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-accent"
      />
    </div>
  );
}
