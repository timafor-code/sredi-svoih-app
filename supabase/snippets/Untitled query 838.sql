select
  title,
  status,
  visibility,
  registration_mode,
  price_amount,
  price_currency,
  starts_at
from events
order by starts_at;