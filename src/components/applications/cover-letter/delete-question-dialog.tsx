"use client"

/**
 * 문항 삭제 확인 (C-05 계열) — UX v5.20 S-46 "문항 편집". 제목·답변이 모두 비면 확인 없이 지우고,
 * 하나라도 있으면 이 다이얼로그를 띄운다. 본문 문구는 명세 그대로다(v5.20에서 "제목"을 더했다, CF-6).
 */
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function DeleteQuestionDialog({
  index,
  onOpenChange,
  onConfirm,
}: {
  /** 0부터 센 문항 index (null = 닫힘) */
  index: number | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={index !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>문항 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            문항 {(index ?? 0) + 1}과 이 문항의 제목·답변·직접 고친 내용·메모·사용한 경력·프로젝트가 함께 삭제돼요. 되돌릴 수 없어요
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm}>
            삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
