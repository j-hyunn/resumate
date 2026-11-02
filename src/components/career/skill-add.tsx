"use client"

/** S-12 스킬 직접 추가 (skills.is_manual = true) */
import * as React from "react"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addManualSkillAction } from "./actions"

export function SkillAdd() {
  const [name, setName] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const submit = () => {
    const v = name.trim()
    if (!v) return
    startTransition(async () => {
      await addManualSkillAction(v)
      setName("")
    })
  }
  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input aria-label="스킬 이름" placeholder="스킬 이름" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="outline" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        추가
      </Button>
    </form>
  )
}
