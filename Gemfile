source "https://rubygems.org"

# Pins Jekyll and its plugins to the exact versions GitHub Pages runs, so a
# local build matches what GitHub serves. See the versions GitHub is currently
# using at https://pages.github.com/versions/
gem "github-pages", group: :jekyll_plugins

# Jekyll 3.x still serves over WEBrick, which left the Ruby standard library in
# Ruby 3.0. Needed for `bundle exec jekyll serve` on any modern Ruby.
gem "webrick", "~> 1.8"
