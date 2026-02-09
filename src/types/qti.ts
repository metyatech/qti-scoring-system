export interface QtiWorkspace {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  itemFiles: string[]
  assessmentTestFile: string
  resultFiles: string[]
  itemCount: number
  resultCount: number
}

export interface QtiWorkspaceSummary {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  itemCount: number
  resultCount: number
}

export interface UpdateWorkspaceRequest {
  name?: string
  description?: string
}

export interface QtiResultUpdateRequest {
  resultFile: string
  items: Array<{
    identifier: string
    criteria?: Array<{
      met: boolean
      criterionText?: string
    }>
    comment?: string
  }>
  preserveMet?: boolean
}
