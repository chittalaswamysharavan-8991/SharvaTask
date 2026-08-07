import { readFileSync, writeFileSync } from 'node:fs';

const path='src/domain/sharvaTaskService.ts';
const source=readFileSync(path,'utf8');
const oldBlock=`export async function searchBoardData(args: { query: string }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const needle = args.query.toLowerCase();
  const summaries = lists
    .filter((list) => {
      return (
        list.title.toLowerCase().includes(needle) ||
        list.project.toLowerCase().includes(needle) ||
        list.list_id.toLowerCase().includes(needle) ||
        list.items.some((item) => item.title.toLowerCase().includes(needle) || item.notes?.toLowerCase().includes(needle))
      );
    })
    .map(summarizeList);

  return withEnvelope(
    {
      view: 'lists',
      message: summaries.length ? \`Found \${summaries.length} list(s) for: \${args.query}\` : \`No lists found for: \${args.query}\`,
      lists: summaries,
      query: args.query
    },
    { events, lists, response_type: 'search_results', mode_recommendation: 'search' }
  );
}`;
const newBlock=`export async function searchBoardData(args: { query: string }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const results = searchRouteTargets(lists, args.query, { includeArchived: false });
  const total = results.lists.length + results.tasks.length;

  return withEnvelope(
    {
      view: 'search',
      message: total
        ? \`Found \${results.tasks.length} task(s) and \${results.lists.length} list(s) for: \${args.query}\`
        : \`No tasks or lists found for: \${args.query}\`,
      lists: results.lists.map(summarizeList),
      task_results: results.tasks,
      query: args.query
    },
    { events, lists, response_type: 'search_results', mode_recommendation: 'search' }
  );
}`;
if(source.includes(newBlock)){console.log('Search contract already patched.');process.exit(0)}
if(!source.includes(oldBlock))throw new Error('Expected searchBoardData block was not found; refusing broad edit.');
writeFileSync(path,source.replace(oldBlock,newBlock));
console.log('Patched searchBoardData to return canonical task/list search results.');
