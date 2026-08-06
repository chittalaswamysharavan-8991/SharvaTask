import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import userFacingWidget from './userFacingWidget.json';

export const SHARVATASK_WIDGET_URI = 'ui://widget/sharvatask-v2-4-clean.html';

type WidgetPresentation = {
  style: string;
  replacements: Array<[string, string]>;
};

function applyUserFacingPresentation(html: string): string {
  const presentation = userFacingWidget as WidgetPresentation;
  let result = html.replace('</style>', `${presentation.style}\n</style>`);

  for (const [technicalCopy, userCopy] of presentation.replacements) {
    result = result.split(technicalCopy).join(userCopy);
  }

  return result;
}

const rawWidgetHtml = readFileSync(
  join(process.cwd(), 'src', 'widget', 'sharvaTaskWidget.html'),
  'utf8'
);

export const sharvaTaskWidgetHtml = applyUserFacingPresentation(rawWidgetHtml);
