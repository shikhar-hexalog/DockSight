import { CornerDownLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { AskAnswer } from '@hexabuild/shared';

import { QueryError } from '@/components/common/QueryError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAsk } from '@/hooks/queries';

const SUGGESTIONS = [
  'Which returns have been pending in Uniware for more than a day?',
  'Which courier is slowest to process this week, and by how much?',
  'How many DTO returns arrived today versus yesterday?',
  'Which dispatch holds still need pulling, by manifest?',
];

function AnswerTable({ answer }: { answer: AskAnswer }) {
  if (!answer.table || answer.table.rows.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="[&_tr]:border-ink">
          <TableRow className="hover:bg-transparent">
            {answer.table.columns.map(column => (
              <TableHead key={column} className="h-8 text-[12.5px] font-normal text-muted-foreground first:pl-0">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {answer.table.rows.map((row, index) => (
            <TableRow key={index} className="text-[13px]">
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className="font-mono text-[12px] first:pl-0">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AnswerView({ asked, answer }: { asked: string; answer: AskAnswer }) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="text-[12.5px] text-muted-foreground">{asked}</p>

      <p className="text-[15px] leading-relaxed whitespace-pre-line">{answer.answer}</p>

      <AnswerTable answer={answer} />
    </div>
  );
}

function AnswerArea({ asked, ask }: { asked: string; ask: ReturnType<typeof useAsk> }) {
  if (ask.isPending) {
    return (
      <div className="flex items-center gap-3 pt-2 text-[13.5px] text-muted-foreground">
        <Spinner />
        Reading the latest data. This takes about a minute.
      </div>
    );
  }

  if (ask.error) {
    return <QueryError error={ask.error} onRetry={() => ask.mutate(asked)} />;
  }

  if (!ask.data) {
    return null;
  }

  return <AnswerView asked={asked} answer={ask.data} />;
}

/** Ask a question in plain words; the answer comes only from the warehouse's own data. */
export function AskPanel() {
  const ask = useAsk();

  const [question, setQuestion] = useState('');

  const [asked, setAsked] = useState('');

  function submit(text: string) {
    const trimmed = text.trim();

    if (trimmed.length < 3) {
      return;
    }

    setAsked(trimmed);

    ask.mutate(trimmed);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="border-b border-ink pb-2">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">Ask about returns</h2>

        <p className="mt-1 text-[12.5px] text-muted-foreground">Answers use only today's data from this app and Uniware, never guesses.</p>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. Which Blue Dart RTOs are still pending?"
          className="h-10 text-[14px]"
        />

        <Button type="submit" className="h-10" disabled={ask.isPending || question.trim().length < 3}>
          Ask
          <CornerDownLeft />
        </Button>
      </form>

      <div className="flex flex-col items-start gap-1.5">
        {SUGGESTIONS.map(suggestion => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              setQuestion(suggestion);
              submit(suggestion);
            }}
            className="text-left text-[13px] text-brand underline-offset-[3px] transition-colors hover:text-ink hover:underline"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <AnswerArea asked={asked} ask={ask} />
    </section>
  );
}
