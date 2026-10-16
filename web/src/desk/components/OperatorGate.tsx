// Asked each time a desk screen opens: who is working here? The last name is
// filled in, so confirming is one press; changing it is just typing.

import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDesk } from '@/desk/DeskProvider';

export function OperatorGate({ question, action }: { question: string; action: string }) {
  const { scanner, setScanner } = useDesk();

  const [confirmed, setConfirmed] = useState(false);

  const [name, setName] = useState(scanner ?? '');

  const ready = name.trim() !== '';

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!ready) {
      return;
    }

    setScanner(name.trim());

    setConfirmed(true);
  }

  return (
    <Dialog open={!confirmed}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{question}</DialogTitle>

            <DialogDescription>Everything you do here is recorded under this name. Change it if someone else is taking over.</DialogDescription>
          </DialogHeader>

          <Input
            value={name}
            onChange={event => setName(event.target.value)}
            onFocus={event => event.target.select()}
            placeholder="Your name"
            aria-label="Your name"
            autoFocus
            className="h-10"
          />

          <Button type="submit" className="h-10" disabled={!ready}>
            {action}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
