import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHARVATASK_WIDGET_URI = 'ui://widget/sharvatask.html';

export const sharvaTaskWidgetHtml = readFileSync(join(process.cwd(), 'src', 'widget', 'sharvaTaskWidget.html'), 'utf8');
