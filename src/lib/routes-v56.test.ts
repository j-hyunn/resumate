import { describe, expect, it } from "vitest"
import { parseRangeParam, routes } from "./routes"

describe("v5.6 L-02 route helpers", () => {
  it("S-10 focus / chat / requirement queries", () => {
    expect(routes.projectPage("p1", { focus: "action" })).toBe("/career/projects/p1?focus=action")
    expect(routes.projectPage("p1", { focus: "star", chat: "c1" })).toBe("/career/projects/p1?focus=star&chat=c1")
    expect(routes.projectPageNew({ experience: "e1", requirement_id: "r1" })).toBe("/career/projects/new?experience=e1&requirement_id=r1")
  })
  it("S-44 ?range={start}-{end} round-trips", () => {
    const href = routes.deliverable("d1", { range: { start: 12, end: 40 } })
    expect(href).toBe("/career/deliverables/d1?range=12-40")
    expect(parseRangeParam(new URL(href, "http://x").searchParams.get("range"))).toEqual({ start: 12, end: 40 })
    expect(routes.deliverable("d1", { range: null })).toBe("/career/deliverables/d1")
  })
  it("parseRangeParam rejects malformed / empty ranges", () => {
    expect(parseRangeParam(undefined)).toBeNull()
    expect(parseRangeParam("5-5")).toBeNull()
    expect(parseRangeParam("9-3")).toBeNull()
    expect(parseRangeParam("a-3")).toBeNull()
    expect(parseRangeParam(["1-2"])).toEqual({ start: 1, end: 2 })
  })
})
