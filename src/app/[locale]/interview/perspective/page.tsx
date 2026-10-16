'use client';

import { JobList } from '@/components/perspective/job-list';
import { InterviewModeSwitch } from '@/components/interview/mode-switch';

export default function PerspectivePage() {
  // 容器和 Header、面试模拟保持完全一致，标题才会和 logo 左对齐
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <InterviewModeSwitch />
      <JobList />
    </div>
  );
}
