# Builds public/scoot/scoot_kb.md: the knowledge base the "Ask SCoot AI" chat answers from.
# Current facts first (they override older text), then every project document. Run by deploy.sh.
import html, os, re
A = os.path.dirname(os.path.abspath(__file__))
def read(p): return open(p, encoding='utf8').read()
def page_text(p):   # visible text of a landing page, without scripts or the phone frame
    s = read(p)
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', s, flags=re.S)
    s = s.split('<div class="phonewrap"')[0]
    s = re.sub(r'<(br|/p|/li|/h[1-3]|/dt|/dd|/tr|/section)[^>]*>', '\n', s)
    return re.sub(r'\n\s*\n+', '\n\n', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()

CURRENT = """# CURRENT FACTS (November 15, 2026). These override anything older below.
- SCoot: USC students rent out their scooters and bikes to other students. You pick one up at the owner's designated area (their rack) and bring it back to the same place. Owners earn money passively.
- Websites: https://scootusc.pages.dev (also https://seamengine.com/scoot). Damian's tap-through day: https://scootusc.pages.dev/damian. Code: https://github.com/erolmk/scoot. Built for the AI@USC hackathon, November 2026, by Erol Kalayoglu (USC Viterbi).
- Prices: each owner sets their own prices, so lending is worth it to them. A start price covers the first 2 hours and 2 miles (usually $5), then a price per started extra hour and per started extra mile (usually $2 each). Missing the owner's curfew costs $15 once. Ordinary (pedal) bikes are priced by time only: no mile price and no mile counter. E-bikes and e-scooters keep the mile price because of the battery.
- Refundable card hold: $25 for electric vehicles, $10 for ordinary bikes, released after the return check.
- Pickup: you have 10 minutes after booking to reach the rack. Scan the rack sticker, photograph the battery (electric only) and the whole vehicle (the "before" photo), then unlock.
- Locks: at launch an owner can use a small combination key box (about $20, bought by the owner) holding the key to their own lock. The renter gets the code after the pickup photos, keeps the key during the ride, and puts it back in the box at the end. The owner changes the code every night when the scooter comes in to charge. Known limit: past renters know the code until that night's change. With the pilot comes a TTLock smart padlock + hardened chain kit ($86, free to the owner) that opens over Bluetooth from the renter's phone.
- Owner share: with a key box the owner keeps 90% of every rental. With SCoot's $86 smart padlock kit the owner keeps 70% while 15% of each fare pays off the kit (the other 15% covers card fees and a safety fund); after the kit is paid off the owner keeps 90%. If an owner quits before the kit is paid off, the lock goes back to SCoot.
- During a ride: park at any rack (lock it and take a photo); time keeps running. The app shows free time left, the curfew, cost so far, a battery estimate (AI photo reading minus miles ridden times that scooter's drain per mile) and the time saved versus walking the same distance at 2 mph.
- Return: back to the same rack, scan the sticker, battery photo, one photo of it locked; the AI checks parking and the lock and compares the return photo with the pickup photo for new damage. A person decides on any damage. Billing stops when the return photo is accepted.
- Battery minimums to start: long-range scooters 40%, medium 50%, short 60%. Battery died: kick it home without the motor, or walk it if riding isn't safe; reporting it moves the curfew back 30 minutes.
- Reporting lock trouble, a crash or a dying phone stops extra-time and curfew fees. If a properly locked scooter is stolen, the renter owes nothing (planned for the pilot: a safety fund pays the owner, backed by insurance before any real rides).
- The AI does four checks from phone photos: battery percent (only when a % sign shows), parking and lock, new damage versus the pickup photo, and a driver's license's type, state and expiry (California requires a license or permit for e-scooters; ordinary bikes don't need one). The AI never approves a rental or charges anyone.
- What is real in the prototype: the app and its rules, and the AI photo checks (live model calls on drawn demo photos). Simulated: USC NetID sign-in, payments, other students and their bookings, rack scans, the lock and key box, DPS registration and staff review. The sample license button skips the AI; a real license photo is checked live.
- Example (Damian): lives at IRC Parkside; 1:00 PM books Ethan's scooter (key box); rides 0.6 mi to Leavey Library (about 5 min riding, 19 min walking at 2 mph), studies 1 hour, rides 0.5 mi to the Lyon Center gym (about 4 min, 14 min walking), works out 1.5 hours, rides 0.5 mi home (about 4 min, 15 min walking). About 2 h 45 min and 1.6 miles: $5 + $2 for one extra hour = $7. About 34 minutes saved. Ethan keeps $6.30.
- Example (Priya): keeps Ben's scooter all day, four hours of class, rides to 30th Street and back, returns 20 minutes after her 2:30 PM curfew: $5 + 4 extra hours ($8) + 1 extra mile ($2) + $15 late fee = $30.
- Interviews: 20 USC students. 6 of 8 scooter owners said they would probably rent theirs out; 9 of 12 students without one said they would probably use it (the other 3 don't make the kind of commute that needs it).
- Pilot plan: Stage 1 is 3 weeks with no rides (about $600): recruit 5 IRC owners, collect 50 trip requests, test 2 lock kits and the AI on 100 real photos, get insurance quotes. Stage 2 is 6 weeks of rides (about $5,000), only if Stage 1 works.
"""
parts = [CURRENT,
         '# THE WEBSITE (landing page text)\n\n' + page_text(os.path.join(A, 'public', 'scoot', 'index.html')),
         '# DEVPOST WRITE-UP\n\n' + read(r'G:\AIUSC\devpost\about.md'),
         '# README\n\n' + read(os.path.join(A, 'README.md')),
         '# COSTS\n\n' + read(os.path.join(A, 'docs', 'COSTS.md')),
         '# PITCH SCRIPT\n\n' + read(os.path.join(A, 'docs', 'PITCH_SCRIPT.md')),
         "# DAMIAN'S DAY (demo video script)\n\n" + read(os.path.join(A, 'docs', 'DAMIAN_90s_SCRIPT.md')),
         '# FULL RULEBOOK (older sections may use earlier numbers; the current facts above win)\n\n' + read(os.path.join(A, 'docs', 'RULEBOOK.md'))]
out = '\n\n---\n\n'.join(parts)
open(os.path.join(A, 'public', 'scoot', 'scoot_kb.md'), 'w', encoding='utf8').write(out)
print('kb words', len(out.split()))
